## Xbox Authentication Flow

Loot Link uses Xbox authentication through three pieces:

1. **Azure / Microsoft OAuth**
2. **OpenXBL**
3. **Cookies**

### Why Azure is needed

Xbox accounts are Microsoft accounts, so the user must first sign in through Microsoft/Azure.

In Azure, we created an app registration so Microsoft knows:

- what app is requesting login
- what redirect URL is allowed
- what client/app credentials belong to us

Required Azure setup:

- App registration
- Client ID
- Client secret
- Redirect URI pointing back to our backend
- Microsoft/Xbox-related permissions/scopes as required by the auth provider

The Azure login proves the user owns a Microsoft account.

### Why OpenXBL is used

After Microsoft login, OpenXBL helps us connect that Microsoft identity to Xbox Live data.

OpenXBL handles the Xbox Live side of the flow and lets our backend request Xbox-related profile data using the authenticated account.

Required OpenXBL setup:

- OpenXBL account/app
- Public API key
- Callback/redirect configuration
- Xbox Live API access through OpenXBL routes

### Why cookies are used

For Xbox auth, we use a cookie to temporarily store the Loot Link user identity during the external login flow.

This matters because once the user leaves our app and goes to Microsoft/OpenXBL, our backend still needs to remember:

> “Which Loot Link user started this Xbox connection?”

So before redirecting the user to Xbox login, we store a short-lived token in a cookie.

Example idea:

```js
res.cookie("xbox_link_token", linkToken, {
  httpOnly: true,
  secure: false,
  sameSite: "lax",
});


EMJ Notes
Azure (Microsoft OAuth) = proves the user owns a Microsoft account
XBL (via OpenXBL) = gives you Xbox data after that identity is proven
-You send user to OpenXBL
-OpenXBL sends them to Microsoft login (Azure OAuth)
-User logs in → Microsoft returns auth proof
-OpenXBL takes that and exchanges it for Xbox Live tokens
-Now OpenXBL can call Xbox APIs

Key point
Azure = identity provider
XBL = data/service layer
OpenXBL = bridge between them