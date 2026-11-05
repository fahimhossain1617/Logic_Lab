import 'dotenv/config';
import { createCoreExpressApp, attachCentralErrorHandler } from '../server/src/app';

const app = createCoreExpressApp();
attachCentralErrorHandler(app);

export default app;
