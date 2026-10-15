import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Falta ${name}. Revisá backend/.env usando .env.example.`);
  }
  return value;
}

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} debe ser un puerto entre 1 y 65535.`);
  }
  return value;
}

export const env = {
  jwtSecret: required('JWT_SECRET'),
  port: port('PORT', 3000),
  db: {
    host: required('DB_HOST'),
    port: port('DB_PORT', 3307),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
  },
};
