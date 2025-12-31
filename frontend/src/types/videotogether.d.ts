export {};

declare global {
  interface Window {
    videoTogetherExtension?: {
      CreateRoom: (roomName: string, password?: string) => void;
      JoinRoom: (roomName: string, password?: string) => void;
      roomName?: string;
    };
  }
}
