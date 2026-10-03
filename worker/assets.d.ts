declare module '*?module' {
    const module: WebAssembly.Module;
    export default module;
}

declare module '*.woff2?inline' {
    const dataUrl: string;
    export default dataUrl;
}
