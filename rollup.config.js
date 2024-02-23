import esbuild from 'rollup-plugin-esbuild';
/** @type {import('rollup').RollupOptions} */
const config = [{
    input: 'src/index.ts',
    external: id => /^(lib0|yjs|y-protocols)/.test(id),
    output: {
        file: 'dist/y-webtransport.mjs',
        format: "es",
        inlineDynamicImports: true,
       
    },
    plugins: [
        esbuild({
            // All options are optional
            include: /\.[jt]sx?$/, // default, inferred from `loaders` option
            exclude: /node_modules/, // default
            sourceMap: true, // default
            minify: process.env.NODE_ENV === 'production',
            target: 'es2017', // default, or 'es20XX', 'esnext'
            jsx: 'transform', // default, or 'preserve'
            jsxFactory: 'React.createElement',
            jsxFragment: 'React.Fragment',
            // Like @rollup/plugin-replace
            define: {
              __VERSION__: '"x.y.z"',
            },
            tsconfig: 'tsconfig.json', // default
            // Add extra loaders
            loaders: {
              // Add .json files support
              // require @rollup/plugin-commonjs
              '.json': 'json',
              // Enable JSX in .js files too
              '.js': 'jsx',
            },
          }),
    ]
}

];

export default config;