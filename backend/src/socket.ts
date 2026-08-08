import type { Server as SocketIOServer } from 'socket.io';
import type { SocketIOInstance } from './types/socket.types.js';

let ioInstance: SocketIOInstance = null;

export const setIO = (io: SocketIOServer): void => {
   ioInstance = io;
};

export const getIO = (): SocketIOInstance => ioInstance;
