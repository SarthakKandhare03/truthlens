// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title  TruthRegistry
 * @notice On-chain provenance registry for photos captured with TruthLens.
 *
 * What lives on-chain (the "source of truth"):
 *   - sha256Hash     SHA-256 of the exact image bytes. Primary key of a record.
 *   - pHash          Perceptual hash (64-bit, left-aligned in a bytes32). Lets the
 *                    verifier find the original of a resized / recompressed copy.
 *   - signerKeyHash  SHA-256 of the capturing device's ECDSA P-256 public key.
 *                    The full public key and the signature live off-chain next to
 *                    the original image; anchoring the key's fingerprint here means
 *                    nobody can later swap in a different key for that image.
 *   - storageURI     Where the original file is kept (local path or s3://...).
 *   - timestamp / blockNumber, set by the chain itself, so they cannot be faked
 *     by the client.
 *
 * What is deliberately NOT on-chain:
 *   - The image itself (far too expensive, and photos can be private).
 *   - The ECDSA signature (64 bytes of extra storage per record). Anyone can
 *     still check it: fetch the public key + signature from storage, confirm
 *     sha256(publicKey) == signerKeyHash, then verify the signature over sha256Hash.
 *
 * Who can write:
 *   Users never pay gas or need a wallet. A backend "relayer" wallet submits the
 *   transactions after it has checked the device signature. Only addresses the
 *   owner has allow-listed as relayers may write. Otherwise anyone could
 *   front-run a registration and "squat" an image hash with a bogus key.
 */
contract TruthRegistry {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Record {
        bytes32 sha256Hash;    // SHA-256 of exact image bytes
        bytes32 pHash;         // perceptual hash (for fuzzy matching)
        bytes32 signerKeyHash; // SHA-256 of the device's public key
        string storageURI;     // pointer to the stored original
        address registrar;     // relayer that submitted the record
        uint48 timestamp;      // block.timestamp at registration (0 = no record)
        uint48 blockNumber;    // block.number at registration
        // registrar (20 bytes) + timestamp (6) + blockNumber (6) = 32 bytes,
        // so those three fields share a single storage slot (cheaper gas).
        uint64 index;          // position in the global registration order
        bytes32 parentHash;    // original this image was edited from (0 = none)
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public owner;
    mapping(address => bool) public isRelayer;

    mapping(bytes32 => Record) private _records;      // sha256Hash => record
    bytes32[] private _allHashes;                      // registration order
    mapping(bytes32 => bytes32[]) private _edits;      // original => edited versions

    // ---------------------------------------------------------------------
    // Events (indexed fields can be filtered on by the Chain Explorer)
    // ---------------------------------------------------------------------

    event ImageRegistered(
        bytes32 indexed sha256Hash,
        bytes32 indexed signerKeyHash,
        address indexed registrar,
        bytes32 pHash,
        string storageURI,
        uint256 index,
        uint256 timestamp
    );

    event EditRecorded(bytes32 indexed originalHash, bytes32 indexed newHash, uint256 timestamp);
    event RelayerUpdated(address indexed relayer, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------------
    // Errors (custom errors are cheaper than revert strings and easy to test)
    // ---------------------------------------------------------------------

    error NotOwner(address caller);
    error NotRelayer(address caller);
    error ZeroAddress();
    error ZeroHash();
    error AlreadyRegistered(bytes32 sha256Hash);
    error NotRegistered(bytes32 sha256Hash);
    error SelfEdit(bytes32 sha256Hash);
    error EditAlreadyLinked(bytes32 newHash, bytes32 existingParent);
    error EditPredatesOriginal(bytes32 originalHash, bytes32 newHash);
    error IndexOutOfRange(uint256 index, uint256 total);

    // ---------------------------------------------------------------------
    // Access control
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    modifier onlyRelayer() {
        if (!isRelayer[msg.sender]) revert NotRelayer(msg.sender);
        _;
    }

    /// @dev The deployer becomes the owner and the first relayer, so local
    ///      development works with a single Hardhat account.
    constructor() {
        owner = msg.sender;
        isRelayer[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit RelayerUpdated(msg.sender, true);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        if (relayer == address(0)) revert ZeroAddress();
        isRelayer[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------

    /**
     * @notice Register a freshly captured image.
     * @dev    pHash may legitimately be zero (e.g. a perfectly flat image), so it
     *         is not validated. The two identity hashes must be non-zero.
     */
    function register(
        bytes32 sha256Hash,
        bytes32 pHash,
        bytes32 signerKeyHash,
        string calldata storageURI
    ) external onlyRelayer {
        if (sha256Hash == bytes32(0) || signerKeyHash == bytes32(0)) revert ZeroHash();
        if (_records[sha256Hash].timestamp != 0) revert AlreadyRegistered(sha256Hash);

        uint64 index = uint64(_allHashes.length);

        _records[sha256Hash] = Record({
            sha256Hash: sha256Hash,
            pHash: pHash,
            signerKeyHash: signerKeyHash,
            storageURI: storageURI,
            registrar: msg.sender,
            timestamp: uint48(block.timestamp),
            blockNumber: uint48(block.number),
            index: index,
            parentHash: bytes32(0)
        });
        _allHashes.push(sha256Hash);

        emit ImageRegistered(
            sha256Hash, signerKeyHash, msg.sender, pHash, storageURI, index, block.timestamp
        );
    }

    /**
     * @notice Link an edited version to the image it was derived from, building
     *         a provenance chain: original -> edit -> edit of edit ...
     * @dev    Both images must already be registered (so every node in the chain
     *         carries its own signature). Rules that keep the chain a clean tree:
     *           1. an image cannot be an edit of itself;
     *           2. an image has at most one parent;
     *           3. the edit must have been registered AFTER the original.
     *         Rule 3 makes cycles (A -> B -> A) impossible, because every link
     *         points forward in registration order.
     */
    function recordEdit(bytes32 originalHash, bytes32 newHash) external onlyRelayer {
        Record storage original = _records[originalHash];
        Record storage edited = _records[newHash];

        if (original.timestamp == 0) revert NotRegistered(originalHash);
        if (edited.timestamp == 0) revert NotRegistered(newHash);
        if (originalHash == newHash) revert SelfEdit(newHash);
        if (edited.parentHash != bytes32(0)) revert EditAlreadyLinked(newHash, edited.parentHash);
        if (edited.index < original.index) revert EditPredatesOriginal(originalHash, newHash);

        edited.parentHash = originalHash;
        _edits[originalHash].push(newHash);

        emit EditRecorded(originalHash, newHash, block.timestamp);
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    /// @notice Full record for a hash. Returns an all-zero record (timestamp == 0)
    ///         when the hash is unknown, so callers do not need try/catch.
    function getRecord(bytes32 sha256Hash) external view returns (Record memory) {
        return _records[sha256Hash];
    }

    function isRegistered(bytes32 sha256Hash) external view returns (bool) {
        return _records[sha256Hash].timestamp != 0;
    }

    /// @notice Direct edited versions of an image (one level down the chain).
    function getEdits(bytes32 sha256Hash) external view returns (bytes32[] memory) {
        return _edits[sha256Hash];
    }

    function totalRecords() external view returns (uint256) {
        return _allHashes.length;
    }

    function hashAt(uint256 index) external view returns (bytes32) {
        if (index >= _allHashes.length) revert IndexOutOfRange(index, _allHashes.length);
        return _allHashes[index];
    }

    /**
     * @notice Page through all registered hashes in registration order.
     * @dev    The backend uses this to rebuild its perceptual-hash search index
     *         straight from the chain. That matters on public testnets like Amoy,
     *         where RPC providers cap how many blocks of event logs one
     *         eth_getLogs call may scan. Out-of-range pages return a short or
     *         empty array instead of reverting.
     */
    function getHashes(uint256 start, uint256 count) external view returns (bytes32[] memory page) {
        uint256 total = _allHashes.length;
        if (start >= total) return new bytes32[](0);
        uint256 end = start + count > total ? total : start + count;
        page = new bytes32[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = _allHashes[i];
        }
    }
}
