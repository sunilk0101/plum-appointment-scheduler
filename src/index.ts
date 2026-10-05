import 'dotenv/config';
import { readConfig } from './config';
import { createApp } from './http/app';

const app = createApp();
const { port } = readConfig();
app.listen(port, () => {
  console.log(`Appointment scheduler listening on http://localhost:${port}`);
});
