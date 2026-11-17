const { execFileSync } = require('node:child_process');

// Send SQL byte-for-byte through the MariaDB client inside the disposable
// container, over its Unix socket. The client understands DELIMITER and the original trigger bodies.
function applySql({ container, password, database, sql, docker = execFileSync }) {
  return docker(
    'docker',
    ['exec', '-i', container, 'mariadb', '--protocol=socket', '--skip-ssl', '-uroot', `-p${password}`, database],
    { input: sql, stdio: 'pipe', timeout: 60000 },
  );
}

module.exports = { applySql };
