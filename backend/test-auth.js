const jwt = require('jsonwebtoken');
const token = jwt.sign({ id: 'user-1', username: 'testuser' }, 'super_secret_dev_key_123');
console.log(token);
