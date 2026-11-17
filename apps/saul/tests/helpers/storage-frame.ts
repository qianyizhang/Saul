import { encodeNative, nativeDecoder } from '../../native/transport.mts';
export function decodeNativeFrame(value: unknown) {
  let message: unknown;
  nativeDecoder((packet) => {
    message = packet;
  })(encodeNative(value));
  return message;
}
