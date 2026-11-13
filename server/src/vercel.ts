import 'dotenv/config';
import { createCoreExpressApp, attachCentralErrorHandler } from './app';

const app = createCoreExpressApp();
attachCentralErrorHandler(app);

export default app;

