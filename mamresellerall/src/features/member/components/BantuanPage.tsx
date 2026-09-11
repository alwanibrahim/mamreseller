import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const WHATSAPP_URL = "https://wa.me/62895327173450";

export function BantuanPage() {
  return (
    <Card>
      <CardHeader className="gap-1.5">
        <CardTitle>Help</CardTitle>
        <CardDescription>Questions or issues? Contact us via WhatsApp.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 rounded-md border p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <MessageCircle className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">WhatsApp Support</p>
            <p className="text-sm text-muted-foreground">0895-3271-7345</p>
          </div>
        </div>
        <Button asChild>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
            <MessageCircle />
            Contact via WhatsApp
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
