#!/usr/bin/env node

/**
 * Health check script for Dill Bot
 * 
 * This script can be used to test if the bot is running properly
 * by making a request to the health endpoint.
 */

const http = require('http');

const port = process.env.PORT || 3000;
const host = process.env.HOST || 'localhost';

const options = {
  hostname: host,
  port: port,
  path: '/health',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const health = JSON.parse(data);
      console.log('✅ Health check passed:');
      console.log(`   Status: ${health.status}`);
      console.log(`   Service: ${health.service}`);
      console.log(`   Uptime: ${Math.round(health.uptime)}s`);
      console.log(`   Memory: ${health.memory}`);
      console.log(`   Active Jobs: ${health.activeJobs}`);
      console.log(`   Message: ${health.message}`);
      
      if (health.status === 'healthy') {
        process.exit(0);
      } else {
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Failed to parse health check response:', error);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Health check failed:', error.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('❌ Health check timed out');
  req.destroy();
  process.exit(1);
});

req.end(); 