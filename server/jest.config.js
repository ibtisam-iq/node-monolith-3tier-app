module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  coverageReporters: ['text', 'lcov', 'cobertura'],
  coverageDirectory: '../coverage',
  collectCoverageFrom: [
    '**/*.js',
    '!node_modules/**',
    '!jest.config.js',
    '!eslint.config.mjs',
    '!server.js'
  ],
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: '..',
        outputName: 'jest-results.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}'
      }
    ]
  ]
};
