import os from "node:os";

export const lanIPv4 = (): string => {
  const nets = os.networkInterfaces();
  const names = Object.keys(nets);
  for (let i = 0; i < names.length; i += 1) {
    const list = nets[names[i]] || [];
    for (let j = 0; j < list.length; j += 1) {
      const net = list[j];
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
};
