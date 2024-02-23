import esbuild from 'rollup-plugin-esbuild';

/** @type {import('rollup').RollupOptions} */
const config = [{
    input: 'src/index.ts',
    external: id => /^(lib0|yjs|y-protocols)/.test(id),
    output: {
        file: 'dist/y-webtransport.mjs',
        format: "es",
        inlineDynamicImports: true,
        sourcemap: true,
    },
    plugins: [
        esbuild({
            // All options are optional
            include: /\.[jt]sx?$/, // default, inferred from `loaders` option
            exclude: /node_modules/, // default
            sourceMap: true, // default
            minify: process.env.NODE_ENV === 'production',
            target: 'es2022', // default, or 'es20XX', 'esnext'
            tsconfig: 'tsconfig.json', // default
          }),
    ]
}

];

export default config;