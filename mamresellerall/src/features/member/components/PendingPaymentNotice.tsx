import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Modal pengingat saat user mencoba bertransaksi padahal ada payment pending
export function PendingPaymentNotice({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Pending transaction</DialogTitle>
          <DialogDescription>
            Go to Orders and cancel the pending transaction before starting a new one.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button asChild onClick={onClose}>
            <Link to="/dashboard/orders">Go to Orders</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
