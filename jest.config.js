// Jest is configured to look only in __tests__/ so stray .test.js files
// at the repo root don't accidentally get picked up.
module.exports = {
  testMatch: ['**/__tests__/**/*.test.js'],
  testEnvironment: 'node',
  // Force Jest to exit after all tests complete, preventing timer leaks
  // from NestedStore or cron jobs started during require()
  forceExit: true,
};
