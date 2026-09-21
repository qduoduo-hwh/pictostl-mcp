export declare const DEFAULT_LONGEST_EDGE_MM = 100;
export declare const MIN_LONGEST_EDGE_MM = 1;
export declare const MAX_LONGEST_EDGE_MM = 1000;
export declare function normalizeLongestEdgeMm(value: unknown): number;
export declare function glbToBinaryStl(glb: Uint8Array, longestEdgeMm?: number): Promise<Uint8Array>;
export declare function writeGlbFile(filePath: string, glb: Uint8Array): Promise<number>;
export declare function writeStlFile(filePath: string, glb: Uint8Array, longestEdgeMm?: number): Promise<{
    bytes: number;
    longestEdgeMm: number;
}>;
