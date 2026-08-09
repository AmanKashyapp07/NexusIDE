export function parseDockerFrameHeader(frameBuffer: Buffer): { streamType: number; payloadSize: number } | null {
   if (frameBuffer.length < 8) return null;
   const streamType = frameBuffer[0] ?? 0;
   const payloadSize = frameBuffer.readUInt32BE(4);
   return { streamType, payloadSize };
}

export function extractDockerPayload(
   frameBuffer: Buffer
): { payload: Buffer; streamType: number; remainingBuffer: Buffer } | null {
   const header = parseDockerFrameHeader(frameBuffer);
   if (!header) return null;
   const { streamType, payloadSize } = header;
   if (frameBuffer.length < 8 + payloadSize) return null;

   const payload = Buffer.from(frameBuffer.subarray(8, 8 + payloadSize));
   const remainingBuffer = Buffer.from(frameBuffer.subarray(8 + payloadSize));
   return { payload, streamType, remainingBuffer };
}
