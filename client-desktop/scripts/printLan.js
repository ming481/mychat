const os = require('os');

const port = process.env.PORT || 5173;
const ifaces = os.networkInterfaces();
const ips = [];

for (const entries of Object.values(ifaces)) {
  for (const iface of entries || []) {
    if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
  }
}

console.log('');
console.log('🌐 前端可通过以下局域网地址访问:');
if (ips.length === 0) {
  console.log('   未检测到局域网网卡');
} else {
  ips.forEach(ip => console.log(`   http://${ip}:${port}`));
}
console.log('');
