export interface ChatMessage {
  id: string;
  role: "customer" | "agent" | "system";
  text: string;
}
