import { Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | null = null;

export const setIO = (io: SocketIOServer) => {
  ioInstance = io;
};

export const getIO = () => ioInstance;
