# URL Shortener

Node.js / TypeScript と標準の `node:http`・`node:crypto` による、フレームワークなしのURL短縮アプリです。UIはplain HTML / CSS / JavaScriptです。

## 起動・検証

Node.js 24以降を使用します。

```sh
npm install
npm test
npm run build
SHORT_URL_BASE_URL=http://localhost:3000 npm start
```

ブラウザーで `http://localhost:3000` を開きます。`npm start` はビルド済みの `dist/src/server.js` を起動します。`public/` も実行環境に必要です。

| 環境変数             | デフォルト            | 制約                                                                               |
| -------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `PORT`               | `3000`                | 1〜65535の整数                                                                     |
| `SHORT_URL_BASE_URL` | `https://example.com` | HTTP(S)のoriginのみ。末尾の `/` は許可。パス・クエリ・フラグメント・認証情報は禁止 |

不正な設定は起動時にエラーになります。ホストは `0.0.0.0` です。短縮URLのoriginは設定値から生成し、リクエストのHostヘッダーは使用しません。デフォルトのexample.comは例示用なので、実際にアクセスできる短縮URLを使う際は公開originに変更してください。

### Apple ContainerでのローカルHTTPS環境

前提: macOS、起動済みのApple Container、ホストのPython 3・OpenSSL・curl。アプリはコンテナ内のNode.js 24でビルド・実行します。

```sh
./container-tool setup-https
./container-tool build
./container-tool test
./container-tool start
./container-tool hosts
./container-tool verify
```

`url-shortener-ui`をデタッチ起動し、CaddyがHTTPSを終端してNodeの`127.0.0.1:3000`へ転送します。originは`https://local.tool.urlstn.kuro-shiba.com`です。ホストの80/443は公開せず、既存の`compressor-ui`やその証明書・設定には触れません。

**ブラウザーで開くための設定（権限操作が必要）:**

1. `./container-tool hosts`が出力する`<コンテナIP> local.tool.urlstn.kuro-shiba.com`を、`sudo nano /etc/hosts`で追加してください。同ドメインの既存行があれば更新し、他ドメインの行は変更しないでください。コンテナを再作成するとIPが変わる場合があります。
2. `./container-tool trust`を実行し、macOSの認証・信頼設定を承認してください。専用CAをログインキーチェーンへ登録します。権限やダイアログ待ちで失敗した場合、信頼設定は完了していません。
3. 必要なら`sudo dscacheutil -flushcache`と`sudo killall -HUP mDNSResponder`で名前解決キャッシュを更新し、上記HTTPS URLを開きます。

`./container-tool verify`は`curl --resolve`と`--cacert`を使い、hosts設定やシステムのCA信頼設定とは独立して、実サーバーの証明書・ホスト名・HTTPS応答を検証します。`-k`は使いません。この成功だけではブラウザーの名前解決・信頼設定の完了を意味しません。

```sh
# hostsとCA信頼設定が完了した後の通常アクセス確認
curl --noproxy '*' --fail --max-time 15 https://local.tool.urlstn.kuro-shiba.com/

./container-tool logs
./container-tool ip
# このアプリのコンテナだけ停止・削除（短縮URLの登録は消えます）
./container-tool stop
# コード変更後は再ビルド・テストして起動
./container-tool build
./container-tool test
./container-tool start
```

証明書は専用の`.certs/`へ生成し、Gitとビルドコンテキストから除外しています。CA秘密鍵はコンテナに渡さず、サーバー証明書と秘密鍵だけを読み取り専用マウントします。サーバー証明書は365日有効です。更新時は停止後に`setup-https`を再実行して起動してください。CAを削除・再生成した場合は再度信頼設定が必要です。

この構成はローカル開発専用です。アプリの既存仕様でNodeは`0.0.0.0:3000`にbindするため、コンテナIPの3000番へはHTTPでも直接アクセスできます。ホストポートの転送、公開DNSの変更、自動起動設定は行いません。

## API

### 生成

`POST /api/shorten`、`Content-Type: application/json`

```json
{ "url": "https://example.org/path" }
```

成功時200:

```json
{ "shortUrl": "https://example.com/Ab12Cd34" }
```

### 復元

`POST /api/resolve`、`Content-Type: application/json`

```json
{ "shortUrl": "https://example.com/Ab12Cd34" }
```

成功時200:

```json
{ "url": "https://example.org/path" }
```

復元は、このサービスが生成した形式の短縮URLのみ受け付けます。別originやクエリ・フラグメントの付加は拒否します。

### リダイレクト

`GET /Ab12Cd34` は登録先へ302を返します。`Cache-Control: no-store` を付けます（API・静的ファイルにも適用）。未登録コードは404です。

エラーは `{"error":"説明"}` 形式。400は不正入力、404は未登録または不明ルート、405はAPIメソッド違反、413は本文サイズ超過、415は非対応メディアタイプ／エンコーディング、503はコード割り当て失敗です。

## 実装上の制約

- URLは `new URL(...).href` で正規化します。ホスト直後の `/` の有無は同一になりますが、`/path` と `/path/` は区別します。WHATWG URL標準によるホスト名・デフォルトポート・ドットセグメントなどの正規化も適用されます。
- HTTP(S)のみ対応し、認証情報、生のC0/C1制御文字を拒否します。入力と正規化後のURLはいずれも最大8,192文字です。
- JSON本文は最大16KiB（バイト単位）。UTF-8のみ、圧縮本文は非対応です。
- 2つのMapでURLとコードを双方向管理します。同一URLは同じコードを返します。確認から登録までは同期処理です。
- コードは暗号学的乱数による8桁英数字です。衝突時は再生成し、128回失敗すると503を返します。テスト用にgeneratorを注入できます。
- 永続化はありません。再起動で全登録が消え、複数プロセス間でも共有されません。容量制限・認証・レート制限も未実装なので、一般公開には別途運用上の対策が必要です。短縮コードを秘密情報の保護には使わないでください。
- サーバーは登録先を取得しません。UIの結果表示は `textContent` のみを使います。
- `node:test` により正規化・衝突・入力検証・HTTP API・302・本文サイズ制限・静的配信を検証します。
