const generation = { currentSessionGeneration: () => counter, advanceSessionGeneration: () => ++counter }; let counter = 0;
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), { createPinia, setActivePinia } = require('pinia');
function setup(api) { setActivePinia(createPinia()); const m = { exports: {} }; const s = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/stores/auth.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText; new Function('require', 'module', 'exports', s)(n => n === '@/services/api' ? api : n === '@/services/sessionGeneration' ? generation : require(n), m, m.exports); const auth = m.exports.useAuthStore(); auth.user = { id: 1, email: 'fixture@test', rol: 'ADMIN' }; auth.sessionChecked = true; return auth; }
const err = status => Object.assign(Error('failure'), { isAxiosError: true, response: status ? { status } : undefined });

for (const response of [200, 401, 500, 'network']) {
    for (const restore of [false, true]) {
        test(`obsolete logout verification ${response}, newer session ${restore}`, async () => {
            let finish;
            let started;
            const ready = new Promise(resolve => { started = resolve; });
            let reads = 0;
            const newerUser = { id: 2, rol: 'CLIENTE' };
            const auth = setup({
                post: async () => { throw err(401); },
                get: () => {
                    if (++reads > 1) return Promise.resolve({ data: { user: newerUser } });
                    started();
                    return new Promise((resolve, reject) => {
                        finish = () => response === 200
                            ? resolve({ data: { user: { id: 1, rol: 'ADMIN' } } })
                            : reject(err(response === 'network' ? undefined : response));
                    });
                },
            });
            const pending = auth.logout();
            await ready;
            auth.clear();
            if (restore) await auth.fetchSession();
            const version = auth.sessionVersion;
            finish();
            assert.equal(await pending, false, 'obsolete operation cannot confirm logout');
            assert.deepEqual(auth.user, restore ? newerUser : null);
            assert.equal(auth.sessionVersion, version);
            assert.equal(auth.loggingOut, false);
            assert.equal(auth.loggingIn, false);
        });
    }
}
test('pending login cannot overlap logout', async () => { let resolve; const a = setup({ post: () => new Promise(r => resolve = r) }); const pending = a.login('a@test', 'fixture'); await assert.rejects(a.logout()); resolve({ data: { user: { id: 2, rol: 'ADMIN' } } }); await pending; assert.equal(a.user.id, 2); });
for (const status of [500, 403, undefined])
    test('logout failure preserves session ' + status, async () => { const a = setup({ post: async () => { throw err(status); } }); await assert.rejects(a.logout()); assert.equal(a.isAuthenticated, true); assert.equal(a.loggingOut, false); });
test('success and duplicate calls, failed retry', async () => { let resolve, calls = 0; const a = setup({ post: () => { calls++; return new Promise(r => resolve = r); } }); const first = a.logout(); assert.equal(await a.logout(), false); assert.equal(calls, 1); resolve(); assert.equal(await first, true); assert.equal(a.isAuthenticated, false); });
test('retry after failure', async () => { let calls = 0; const a = setup({ post: async () => { if (++calls === 1)
        throw err(500); } }); await assert.rejects(a.logout()); assert.equal(await a.logout(), true); assert.equal(a.isAuthenticated, false); });
for (const status of [401, 500, 200])
    test('logout 401 must verify me ' + status, async () => { const a = setup({ post: async () => { throw err(401); }, get: async () => { if (status !== 200)
            throw err(status); return { data: { user: { id: 1, rol: 'ADMIN' } } }; } }); if (status === 401) {
        assert.equal(await a.logout(), true);
        assert.equal(a.isAuthenticated, false);
    }
    else {
        await assert.rejects(a.logout());
        assert.equal(a.isAuthenticated, true);
    } });
test('late me cannot resurrect successful logout', async () => { let resolve; const a = setup({ get: () => new Promise(r => resolve = r), post: async () => { } }); const pending = a.fetchSession(); await a.logout(); resolve({ data: { user: { id: 1, rol: 'ADMIN' } } }); await pending; assert.equal(a.isAuthenticated, false); });
test('me failure preserves session; confirmed expiry clears', async () => { let status = 500; const a = setup({ get: async () => { throw err(status); } }); await assert.rejects(a.fetchSession()); assert.equal(a.isAuthenticated, true); status = 401; await a.fetchSession(); assert.equal(a.isAuthenticated, false); });
test('login completion advances generation and an intervening clear cannot restore user', async () => {
 let finish; const auth=setup({post:()=>new Promise(resolve=>{finish=resolve})});
 const pending=auth.login('fixture@test','fixture');const during=auth.sessionVersion;
 finish({data:{user:{id:2,rol:'ADMIN'}}});await pending;
 assert.ok(auth.sessionVersion>during);assert.equal(auth.user.id,2);assert.equal(auth.loggingIn,false);
 const second=auth.login('fixture@test','fixture');auth.clear();const newer=auth.sessionVersion;
 finish({data:{user:{id:3,rol:'ADMIN'}}});await assert.rejects(second);
 assert.equal(auth.user,null);assert.equal(auth.sessionVersion,newer);assert.equal(auth.loggingIn,false);
});
