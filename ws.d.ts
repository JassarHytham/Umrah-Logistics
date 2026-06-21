declare module "ws" {
  import type { IncomingMessage } from "http";

  export default class WebSocket {
    static OPEN: number;
    readyState: number;
    constructor(address: string);
    send(data: string): void;
    close(): void;
    once(event: "open" | "error", listener: (...args: any[]) => void): this;
    on(event: "message", listener: (data: any) => void): this;
  }

  export class WebSocketServer {
    constructor(options: { noServer: boolean });
    on(event: "connection", listener: (ws: WebSocket, request: IncomingMessage) => void): this;
    handleUpgrade(
      request: IncomingMessage,
      socket: any,
      head: Buffer,
      callback: (ws: WebSocket) => void
    ): void;
    emit(event: "connection", ws: WebSocket, request: IncomingMessage): boolean;
  }
}
