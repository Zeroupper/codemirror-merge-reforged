import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const config = [
  // Build the JavaScript bundle
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'cjs',
        sourcemap: true
      },
      {
        file: 'dist/index.esm.js',
        format: 'es',
        sourcemap: true
      }
    ],
    plugins: [
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false
      })
    ],
    external: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/history',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/search',
      'codemirror'
    ]
  },
  // Build the TypeScript declarations
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es'
    },
    plugins: [dts()],
    external: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/history',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/search',
      'codemirror'
    ]
  }
];

export default config;