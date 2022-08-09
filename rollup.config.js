import builtins from 'rollup-plugin-node-builtins';
import resolve from 'rollup-plugin-node-resolve';
import commonJS from 'rollup-plugin-commonjs'
import json from 'rollup-plugin-json';

export default [
  {
    input: 'src/static/client.js',
    output: [{
      file: 'src/static/client-bundle.js',
      name: 'Client',
      format: 'iife',
      sourcemap: 'inline'
    }],
    plugins: [
      json(),
      builtins(),
      resolve({
        browser: true
      }),
      commonJS({
        include: ['node_modules/**','src/config.js']
      }),
    ]
  }
];
