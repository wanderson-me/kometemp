'use strict';
// Gera o hash de uma senha para usar em APP_PASSWORD_HASH (assim a senha em texto puro nunca fica no servidor).
// Uso: npm run hash-password -- "minha senha"
const { hashPassword } = require('../lib/auth');
const pw = process.argv[2];
if (!pw || pw.length < 8) {
  console.error('Uso: npm run hash-password -- "sua senha (mínimo 8 caracteres)"');
  process.exit(1);
}
console.log(hashPassword(pw));
