import express, { ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { adminRouter } from './routes/admin.routes';
import { authPassport } from './config/passport.config';
import { catalogRouter } from './routes/catalog.routes';
import { categoryRouter } from './routes/category.routes';
import { cartRouter } from './routes/cart.routes';
import { env } from './config/env.config';
import { httpSecurity } from './middlewares/http-security.middleware';
import { MariaDbPricingSource } from './repositories/pricing.source';
import { PricingService } from './services/pricing/pricing.service';
import { createPricingRouter } from './routes/pricing.routes';
import { adminAccountPrivacy } from './middlewares/adminAccountPrivacy.middleware';
import { cuentaCorrienteRouter } from './routes/cuentaCorriente.routes';
import { accountOrderPrivateResponses } from './middlewares/account-order-http.middleware';
import { accountOrderRouter, clientOrderRouter } from './routes/accountOrder.routes';

export const app = express();
app.set('trust proxy', env.httpSecurity.trustedProxies);

app.use(
  '/api/pedidos',
  accountOrderPrivateResponses,
);

app.use(adminAccountPrivacy);
app.use('/api', httpSecurity(env.httpSecurity));

app.use(cookieParser());
app.use(authPassport.initialize());

// Auth procesa su JSON para conservar { message } sin cambiar otras rutas.
app.use('/api/auth', authRouter);
app.use(express.json());
app.use('/api', healthRouter);
app.use('/api', catalogRouter);
app.use('/api', categoryRouter);
app.use('/api', createPricingRouter(new PricingService(new MariaDbPricingSource())));
app.use('/api/admin', adminRouter);
app.use('/api/carrito', cartRouter);
app.use('/api/cuenta-corriente', cuentaCorrienteRouter);
app.use('/api/pedidos/cuenta-corriente', accountOrderRouter);
app.use('/api/pedidos', clientOrderRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = Number(error.status);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ error: 'Solicitud inválida' });
    return;
  }
  console.error('Error interno al procesar una solicitud.');
  res.status(500).json({ error: 'Error interno del servidor' });
};

app.use(handleError);