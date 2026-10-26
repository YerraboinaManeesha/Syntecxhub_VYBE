import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

export async function connectDb(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  // Make sure unique indexes exist before accepting traffic. Duplicate-prevention depends on them.
  await mongoose.connection.syncIndexes();
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
