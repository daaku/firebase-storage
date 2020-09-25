import { Auth } from '@daaku/firebase-auth';
import { nanoid } from 'nanoid/index.js';
import { FirebaseStorageClient } from '../src';

async function makeClient(): Promise<[Auth, FirebaseStorageClient]> {
  const auth = await Auth.new({
    apiKey: 'AIzaSyCnFgFqO3d7RbJDcNAp_eO21KSOISCP9IU',
  });
  const storage = new FirebaseStorageClient({
    storageBucket: 'fidb-unit-test.appspot.com',
    tokenSource: auth.getBearerToken.bind(auth),
  });
  return [auth, storage];
}

QUnit.test('do flow', async (assert) => {
  const [auth, storage] = await makeClient();
  await auth.signUp({});
  const input = { hello: 'world' };
  const blob = new Blob([JSON.stringify(input, null, 2)], {
    type: 'application/json',
  });
  const path = nanoid();
  await storage.upload(path, blob);
  const metadata = await storage.metadata(path);
  assert.equal(metadata.name, path, 'expect the path back in name');
  const downloadURL = await storage.downloadURL(path);
  const res = await fetch(`https://cors-anywhere.herokuapp.com/${downloadURL}`);
  const actual = await res.json();
  assert.deepEqual(actual, input, 'expect our object back');
  await storage.delete(path);
  await auth.delete();
});
