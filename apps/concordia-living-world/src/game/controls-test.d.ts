export {};

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      getPos: () => { x: number; z: number };
      getCamYaw: () => number;
      getKeys?: () => string[];
      setKeys?: (codes: string[]) => void;
      setSteer?: (v: number) => void;
      setPos?: (x: number, z: number) => void;
    };
  }
}
