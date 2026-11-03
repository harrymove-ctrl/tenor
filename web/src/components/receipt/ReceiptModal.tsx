import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Modal } from "@/components/interior/modal";
import { SegmentedControl } from "@/components/interior/segmented-control";
import { LoadingButton } from "@/components/interior/loading-button";
import { CopyButton } from "@/components/interior/copy-button";
import { ReceiptCard, type ReceiptTheme } from "@/components/receipt/ReceiptCard";
import { KIND_TITLE, shareUrl, type Receipt } from "@/lib/receipt";

type Props = { receipt: Receipt | null; shared?: boolean; fresh?: boolean; onClose: () => void };

export function ReceiptModal({ receipt, shared = false, fresh = false, onClose }: Props) {
  const [theme, setTheme] = useState<ReceiptTheme>(() => {
    try {
      return (localStorage.getItem("tenor.receiptTheme") as ReceiptTheme) || "paper";
    } catch {
      return "paper";
    }
  });
  const ticket = useRef<HTMLDivElement>(null);

  const pickTheme = (v: string) => {
    setTheme(v as ReceiptTheme);
    try {
      localStorage.setItem("tenor.receiptTheme", v);
    } catch {
      // per-viewer convenience only
    }
  };

  async function download() {
    if (!ticket.current || !receipt) return;
    const url = await toPng(ticket.current, { pixelRatio: 2, cacheBust: true });
    const a = document.createElement("a");
    a.href = url;
    a.download = `tenor-${receipt.kind}-${receipt.market}-${receipt.at}.png`;
    a.click();
  }

  return (
    <Modal
      open={!!receipt}
      onClose={onClose}
      title={shared ? "Shared receipt" : receipt ? KIND_TITLE[receipt.kind] : "Receipt"}
      description={shared ? "Someone shared this Tenor receipt with you." : "Download it or share a link that reopens this receipt."}
      maxWidth={500}
    >
      {receipt && (
        <div className="flex flex-col gap-4">
          <SegmentedControl
            label="Receipt style"
            value={theme}
            onValueChange={pickTheme}
            options={[
              { value: "paper", label: "Paper" },
              { value: "night", label: "Night" },
            ]}
          />
          <ReceiptCard ref={ticket} receipt={receipt} theme={theme} thunk={fresh} />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <LoadingButton onAction={download} pendingLabel="Rendering" successLabel="Saved" errorLabel="Try again">
              Download PNG
            </LoadingButton>
            <CopyButton value={shareUrl(receipt)} label="Copy link" copiedLabel="Link copied" />
          </div>
        </div>
      )}
    </Modal>
  );
}
