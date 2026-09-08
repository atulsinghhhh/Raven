import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const customJestConfig = {
  // Node, not jsdom: what's tested here is the content pipeline and the
  // ranking function: both plain data transforms that read files from
  // disk. The one client component is UI over these, and testing the
  // logic directly is what catches a bad ranking change.
  testEnvironment: 'node',
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
};

export default createJestConfig(customJestConfig);
