// /verify: the main demo moment. Drop any image to get its provenance verdict.
import type { Metadata } from "next";
import { VerifyView } from "@/components/verify/verify-view";

export const metadata: Metadata = { title: "Verify · TruthLens" };

export default function VerifyPage() {
  return <VerifyView />;
}
