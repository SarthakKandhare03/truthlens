// Tests for TruthRegistry.sol
//
// Run with:  npm test
//
// Each test loads a fresh deployment via `loadFixture`. The fixture is deployed
// once, snapshotted, and the snapshot is restored before every test, so tests
// never leak state into each other.
import { expect } from "chai";
import { network } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import { webcrypto } from "node:crypto";

const { ethers, networkHelpers } = await network.create();

const ZERO = ethers.ZeroHash;

// ---------------------------------------------------------------------------
// Helpers that mirror what the real app will send to the contract
// ---------------------------------------------------------------------------

/** SHA-256 of some fake "image bytes" (the real app hashes the JPEG/PNG file). */
function imageHash(label: string): string {
  return ethers.sha256(ethers.toUtf8Bytes(`image-bytes:${label}`));
}

/** A 64-bit perceptual hash, left-aligned into bytes32 like the app will do. */
function pHash(hex16: string): string {
  return ethers.zeroPadBytes(`0x${hex16}`, 32);
}

/**
 * Fingerprint of a real ECDSA P-256 device key, the same kind the browser
 * creates with the Web Crypto API: SHA-256 of the raw (uncompressed) public key.
 */
async function deviceKeyHash(): Promise<string> {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const raw = await webcrypto.subtle.exportKey("raw", pair.publicKey);
  return ethers.sha256(new Uint8Array(raw));
}

async function deployRegistry() {
  const [owner, relayer, stranger] = await ethers.getSigners();
  const registry = await ethers.deployContract("TruthRegistry");
  const keyHash = await deviceKeyHash();
  return { registry, owner, relayer, stranger, keyHash };
}

describe("TruthRegistry", function () {
  // -------------------------------------------------------------------------
  describe("Deployment & access control", function () {
    it("makes the deployer the owner and the first relayer", async function () {
      const { registry, owner } = await networkHelpers.loadFixture(deployRegistry);
      expect(await registry.owner()).to.equal(owner.address);
      expect(await registry.isRelayer(owner.address)).to.equal(true);
      expect(await registry.totalRecords()).to.equal(0n);
    });

    it("lets the owner add and remove relayers", async function () {
      const { registry, relayer, keyHash } = await networkHelpers.loadFixture(deployRegistry);

      await expect(registry.setRelayer(relayer.address, true))
        .to.emit(registry, "RelayerUpdated")
        .withArgs(relayer.address, true);
      await registry.connect(relayer).register(imageHash("a"), pHash("ff00ff00ff00ff00"), keyHash, "local://a.jpg");
      expect(await registry.totalRecords()).to.equal(1n);

      await registry.setRelayer(relayer.address, false);
      await expect(
        registry.connect(relayer).register(imageHash("b"), ZERO, keyHash, "local://b.jpg"),
      )
        .to.be.revertedWithCustomError(registry, "NotRelayer")
        .withArgs(relayer.address);
    });

    it("blocks non-owners from managing relayers or ownership", async function () {
      const { registry, stranger } = await networkHelpers.loadFixture(deployRegistry);
      await expect(registry.connect(stranger).setRelayer(stranger.address, true))
        .to.be.revertedWithCustomError(registry, "NotOwner")
        .withArgs(stranger.address);
      await expect(registry.connect(stranger).transferOwnership(stranger.address))
        .to.be.revertedWithCustomError(registry, "NotOwner");
    });

    it("rejects the zero address for relayers and owners", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);
      await expect(registry.setRelayer(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress",
      );
      await expect(registry.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        registry,
        "ZeroAddress",
      );
    });

    it("transfers ownership", async function () {
      const { registry, owner, stranger } = await networkHelpers.loadFixture(deployRegistry);
      await expect(registry.transferOwnership(stranger.address))
        .to.emit(registry, "OwnershipTransferred")
        .withArgs(owner.address, stranger.address);
      expect(await registry.owner()).to.equal(stranger.address);
      // The old owner has lost its admin rights.
      await expect(registry.setRelayer(owner.address, false)).to.be.revertedWithCustomError(
        registry,
        "NotOwner",
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("Registration", function () {
    it("stores the full record with chain-assigned timestamp and block", async function () {
      const { registry, owner, keyHash } = await networkHelpers.loadFixture(deployRegistry);
      const h = imageHash("sunset");
      const p = pHash("8f3c1e0077aa55cc");

      const tx = await registry.register(h, p, keyHash, "local://originals/sunset.jpg");
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const rec = await registry.getRecord(h);
      expect(rec.sha256Hash).to.equal(h);
      expect(rec.pHash).to.equal(p);
      expect(rec.signerKeyHash).to.equal(keyHash);
      expect(rec.storageURI).to.equal("local://originals/sunset.jpg");
      expect(rec.registrar).to.equal(owner.address);
      expect(rec.timestamp).to.equal(BigInt(block!.timestamp));
      expect(rec.blockNumber).to.equal(BigInt(receipt!.blockNumber));
      expect(rec.index).to.equal(0n);
      expect(rec.parentHash).to.equal(ZERO);
    });

    it("emits ImageRegistered with all searchable fields", async function () {
      const { registry, owner, keyHash } = await networkHelpers.loadFixture(deployRegistry);
      const h = imageHash("cat");
      const p = pHash("0123456789abcdef");

      await expect(registry.register(h, p, keyHash, "local://cat.jpg"))
        .to.emit(registry, "ImageRegistered")
        .withArgs(h, keyHash, owner.address, p, "local://cat.jpg", 0n, anyValue);
    });

    it("rejects duplicate registrations of the same image bytes", async function () {
      const { registry, keyHash } = await networkHelpers.loadFixture(deployRegistry);
      const h = imageHash("dup");
      await registry.register(h, pHash("aaaaaaaaaaaaaaaa"), keyHash, "local://1.jpg");

      // Even with different metadata, the same SHA-256 can only be registered once.
      // The first registration is the proof of "who had it first".
      await expect(registry.register(h, pHash("bbbbbbbbbbbbbbbb"), keyHash, "local://2.jpg"))
        .to.be.revertedWithCustomError(registry, "AlreadyRegistered")
        .withArgs(h);
      expect(await registry.totalRecords()).to.equal(1n);
    });

    it("rejects zero image hash or zero signer key hash", async function () {
      const { registry, keyHash } = await networkHelpers.loadFixture(deployRegistry);
      await expect(registry.register(ZERO, ZERO, keyHash, "x")).to.be.revertedWithCustomError(
        registry,
        "ZeroHash",
      );
      await expect(
        registry.register(imageHash("x"), ZERO, ZERO, "x"),
      ).to.be.revertedWithCustomError(registry, "ZeroHash");
    });

    it("accepts an all-zero perceptual hash (a flat image hashes to zero)", async function () {
      const { registry, keyHash } = await networkHelpers.loadFixture(deployRegistry);
      await registry.register(imageHash("black-frame"), ZERO, keyHash, "local://black.jpg");
      expect(await registry.isRegistered(imageHash("black-frame"))).to.equal(true);
    });

    it("blocks accounts that are not relayers", async function () {
      const { registry, stranger, keyHash } = await networkHelpers.loadFixture(deployRegistry);
      await expect(
        registry.connect(stranger).register(imageHash("spoof"), ZERO, keyHash, "x"),
      )
        .to.be.revertedWithCustomError(registry, "NotRelayer")
        .withArgs(stranger.address);
    });
  });

  // -------------------------------------------------------------------------
  describe("Lookups", function () {
    it("returns an empty record (timestamp 0) for unknown hashes", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);
      const rec = await registry.getRecord(imageHash("never-seen"));
      expect(rec.timestamp).to.equal(0n);
      expect(rec.sha256Hash).to.equal(ZERO);
      expect(await registry.isRegistered(imageHash("never-seen"))).to.equal(false);
    });

    it("enumerates hashes in registration order, with pagination", async function () {
      const { registry, keyHash } = await networkHelpers.loadFixture(deployRegistry);
      const hashes = ["a", "b", "c", "d", "e"].map(imageHash);
      for (const h of hashes) await registry.register(h, ZERO, keyHash, "x");

      expect(await registry.totalRecords()).to.equal(5n);
      expect(await registry.hashAt(2)).to.equal(hashes[2]);
      expect(await registry.getHashes(0, 2)).to.deep.equal(hashes.slice(0, 2));
      expect(await registry.getHashes(3, 10)).to.deep.equal(hashes.slice(3)); // clipped at the end
      expect(await registry.getHashes(5, 10)).to.deep.equal([]); // past the end
    });

    it("reverts hashAt for an index that does not exist", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistry);
      await expect(registry.hashAt(0))
        .to.be.revertedWithCustomError(registry, "IndexOutOfRange")
        .withArgs(0n, 0n);
    });
  });

  // -------------------------------------------------------------------------
  describe("Edit chains (provenance)", function () {
    /** Registers original -> edit1 -> edit2 and returns their hashes. */
    async function deployWithChain() {
      const base = await deployRegistry();
      const [orig, edit1, edit2] = ["orig", "crop", "crop+filter"].map(imageHash);
      for (const h of [orig, edit1, edit2]) {
        await base.registry.register(h, ZERO, base.keyHash, "x");
      }
      return { ...base, orig, edit1, edit2 };
    }

    it("links an edited version to its original", async function () {
      const { registry, orig, edit1 } = await networkHelpers.loadFixture(deployWithChain);

      await expect(registry.recordEdit(orig, edit1))
        .to.emit(registry, "EditRecorded")
        .withArgs(orig, edit1, anyValue);
      expect((await registry.getRecord(edit1)).parentHash).to.equal(orig);
      expect(await registry.getEdits(orig)).to.deep.equal([edit1]);
    });

    it("supports multi-level chains that can be walked back to the root", async function () {
      const { registry, orig, edit1, edit2 } = await networkHelpers.loadFixture(deployWithChain);
      await registry.recordEdit(orig, edit1);
      await registry.recordEdit(edit1, edit2);

      // Walk parents from the newest version back to the original. This is
      // exactly what the provenance timeline in the UI will do.
      const path: string[] = [edit2];
      let cursor = edit2;
      while (true) {
        const parent = (await registry.getRecord(cursor)).parentHash;
        if (parent === ZERO) break;
        path.unshift(parent);
        cursor = parent;
      }
      expect(path).to.deep.equal([orig, edit1, edit2]);
    });

    it("allows several independent edits of one original (a tree)", async function () {
      const { registry, orig, edit1, edit2 } = await networkHelpers.loadFixture(deployWithChain);
      await registry.recordEdit(orig, edit1);
      await registry.recordEdit(orig, edit2);
      expect(await registry.getEdits(orig)).to.deep.equal([edit1, edit2]);
    });

    it("requires both images to be registered", async function () {
      const { registry, orig } = await networkHelpers.loadFixture(deployWithChain);
      const ghost = imageHash("ghost");
      await expect(registry.recordEdit(ghost, orig))
        .to.be.revertedWithCustomError(registry, "NotRegistered")
        .withArgs(ghost);
      await expect(registry.recordEdit(orig, ghost))
        .to.be.revertedWithCustomError(registry, "NotRegistered")
        .withArgs(ghost);
    });

    it("rejects an image being an edit of itself", async function () {
      const { registry, orig } = await networkHelpers.loadFixture(deployWithChain);
      await expect(registry.recordEdit(orig, orig))
        .to.be.revertedWithCustomError(registry, "SelfEdit")
        .withArgs(orig);
    });

    it("rejects giving an edit a second parent", async function () {
      const { registry, orig, edit1, edit2 } = await networkHelpers.loadFixture(deployWithChain);
      await registry.recordEdit(orig, edit2);
      await expect(registry.recordEdit(edit1, edit2))
        .to.be.revertedWithCustomError(registry, "EditAlreadyLinked")
        .withArgs(edit2, orig);
    });

    it("rejects edits registered before their original, which makes cycles impossible", async function () {
      const { registry, orig, edit1 } = await networkHelpers.loadFixture(deployWithChain);
      await registry.recordEdit(orig, edit1);
      // Trying to close the loop edit1 -> orig would create a cycle.
      await expect(registry.recordEdit(edit1, orig))
        .to.be.revertedWithCustomError(registry, "EditPredatesOriginal")
        .withArgs(edit1, orig);
    });

    it("only lets relayers record edits", async function () {
      const { registry, stranger, orig, edit1 } = await networkHelpers.loadFixture(deployWithChain);
      await expect(registry.connect(stranger).recordEdit(orig, edit1))
        .to.be.revertedWithCustomError(registry, "NotRelayer")
        .withArgs(stranger.address);
    });
  });
});
