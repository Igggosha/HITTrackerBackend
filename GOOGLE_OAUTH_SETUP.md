# Google OAuth: налаштування

## 1. Підготувати базу й змінні середовища

1. Скопіюйте `.env.example` у `.env` і вкажіть сильні випадкові значення для
   `JWT_SECRET` та `OAUTH_SESSION_SECRET`.
2. Застосуйте актуальні Drizzle-міграції вашим звичайним способом.
3. Локальні значення redirect мають бути такими:

   ```env
   GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
   OAUTH_SUCCESS_REDIRECT_URL=http://localhost:5173/auth/google/callback
   OAUTH_MOBILE_REDIRECT_URL=hit-tracker-mobile://auth/google/callback
   ```

   `OAUTH_SUCCESS_REDIRECT_URL` необов'язковий. Якщо його не вказати, callback
   повертає JSON. Якщо вказати, бекенд перенаправляє браузер на цю адресу з
   `accessToken` у URL-фрагменті (після `#`), який не передається на сервер.

## 2. Створити OAuth-клієнт у Google Cloud

1. Відкрийте [Google Cloud Console](https://console.cloud.google.com/) і
   створіть або виберіть проєкт у селекторі зверху.
2. Відкрийте **Google Auth Platform** → **Branding**. Якщо платформа ще не
   налаштована, натисніть **Get started**. Заповніть назву застосунку,
   support email і contact email розробника. Для production додайте URL сайту,
   Privacy Policy та Terms of Service.
3. Відкрийте **Audience**:
   - для акаунтів лише вашої Google Workspace-організації виберіть
     **Internal**;
   - для звичайних користувачів виберіть **External**. У режимі тестування
     додайте власні адреси на вкладці **Test users**; інші користувачі не
     зможуть увійти.
4. У **Data Access** залиште тільки базові scopes: `openid`, `email`,
   `profile`. Цей бекенд не запитує доступ до Drive, Calendar або інших даних.
5. Відкрийте **Clients** → **Create client** → тип **Web application**.
6. В **Authorized redirect URIs** натисніть **Add URI** і введіть *точно*:

   ```text
   http://localhost:3000/auth/google/callback
   ```

   Для production додайте окремий URI, наприклад
   `https://api.example.com/auth/google/callback`. Значення повинно збігатися
   символ у символ із `GOOGLE_CALLBACK_URL`: протокол, домен, порт і шлях.
7. Натисніть **Create**, скопіюйте **Client ID** та **Client secret** у `.env`:

   ```env
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

   Client secret не зберігайте у фронтенді, Git або публічних логах.

## 3. Підключити web-фронтенд

Запустіть бекенд:

```bash
npm run start:dev
```

Кнопка «Увійти через Google» має перенаправляти браузер на:

```text
http://localhost:3000/auth/google
```

Після успіху відбувається callback. Новий користувач створюється, а наявний
користувач з такою ж перевіреною Google-поштою автоматично прив'язується до
Google. Усі наступні входи повертають ваш існуючий JWT `accessToken`.

Для фронтенду з `OAUTH_SUCCESS_REDIRECT_URL` прочитайте токен так:

```ts
const accessToken = new URLSearchParams(window.location.hash.slice(1)).get('accessToken');
```

Збережіть його так само, як токен звичайного логіну, і відразу приберіть
фрагмент з адреси через `history.replaceState(null, '', location.pathname)`.

## 4. Підключити React Native Expo

Бекенд не треба міняти або створювати для нього інший Google OAuth client.
Google callback завжди лишається HTTPS/HTTP-адресою бекенду, а вже бекенд
повертає користувача в мобільний застосунок через deep link.

1. Використовуйте схему з `app.json` фронтенду:

   ```json
   {
     "expo": {
     "scheme": "hit-tracker-mobile"
     }
   }
   ```

2. Створіть development build або production build; для OAuth не
   використовуйте Expo Go, оскільки стабільна власна схема там недоступна.
3. У `.env` бекенду вкажіть:

   ```env
   OAUTH_MOBILE_REDIRECT_URL=hit-tracker-mobile://auth/google/callback
   ```

   Не додавайте цей `hit-tracker-mobile://...` URI у Google Console. У **Authorized redirect
   URIs** має залишитися лише `http://localhost:3000/auth/google/callback`
   (або production HTTPS callback вашого бекенду).
4. Mobile-клієнт починає OAuth через `/auth/google?platform=mobile`; backend
   зберігає цей признак у серверній OAuth-сесії та після callback повертає
   користувача за `OAUTH_MOBILE_REDIRECT_URL`. Не передавайте platform через
   OAuth `state`: Passport використовує state для CSRF-захисту.

5. Відкривайте авторизацію з RN через `WebBrowser.openAuthSessionAsync`,
   передаючи `Linking.createURL('auth/google/callback')` як redirect URL.
   Для локального фізичного телефону `localhost` не працює: використайте
   доступну телефону HTTPS-адресу API (наприклад, тунель) і внесіть її callback
   у Google Console.

   Приклад URL старту авторизації:

   ```ts
   https://api.example.com/auth/google?platform=mobile
   ```
6. Обробіть повернення deep link:

   ```ts
   import * as Linking from 'expo-linking';

   function handleGoogleCallback(url: string) {
     const accessToken = Linking.parse(url).queryParams.accessToken;
     if (typeof accessToken === 'string') {
       // Зберегти токен у вашому secure storage та перейти в застосунок.
     }
   }

   Linking.getInitialURL().then((url) => url && handleGoogleCallback(url));
   const subscription = Linking.addEventListener('url', ({ url }) =>
     handleGoogleCallback(url),
   );
   // У cleanup компонента: subscription.remove()
   ```

   Для custom scheme токен передається як query-параметр deep link. Для web
   callback він, як і раніше, передається у фрагменті URL.

## 5. Production-перевірка

- Використовуйте лише HTTPS і встановіть `NODE_ENV=production`.
- Додайте production-домени на **Branding** та callback у **Clients**. Google
  вимагає, щоб ви володіли цими доменами.
- Для External-застосунку опублікуйте Branding/Audience перед запуском для
  всіх користувачів. Брендинг і деякі scopes можуть потребувати Google
  verification; базові `email` і `profile` не є sensitive scopes.
- Поточний `express-session` memory store підходить для локальної розробки або
  одного процесу. Перед кількома інстансами підключіть спільне session storage
  (наприклад Redis), інакше OAuth `state` може потрапити на інший інстанс.

## Маршрути

| Метод | Маршрут | Призначення |
| --- | --- | --- |
| GET | `/auth/google` | Починає Google OAuth і перенаправляє на Google |
| GET | `/auth/google/callback` | Приймає callback, створює/зв'язує користувача, видає JWT |
