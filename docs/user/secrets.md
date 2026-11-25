# Secrets

Some things Majordome connects to need a key or a token: an AI provider, a voice service, a usage
dashboard. You can paste the key into its field, or keep it somewhere safer and give Majordome only
a _reference_ to it, such as `keychain://Majordome/openai`. Settings then hold the reference, never
the key, and Majordome's server reads the key at the moment it needs it.

## Keys your assistant can use

Separate from the above: an API key, a token or a password you want your assistant to use, for
example to read your runs from a sports service. **Settings → Passwords and keys** lists them under
**Keys your assistant can use**, on the computer and in the iPhone app.

- **Add a key** asks for a name, what it is for, and the key. The key is not shown again.
- Or give the key to your assistant in a chat and ask it to keep it.
- **Remove** takes it away from the assistant and deletes Majordome's copy. The key still works
  wherever it came from, so cancel it there if it should stop working.
- Each key shows when the assistant last used it.
- **Works until** is for a key that stops working after a while. Write the day (`2027-11-25`) or
  how long it lasts (`1 year`, `90 days`) when you add the key, or later with **Set last day**. You
  can also tell your assistant, "it lasts a year". In its last month the key says so in the list,
  and your assistant tells you when it uses it, so a routine does not start failing unannounced.
  Majordome does not stop the key on that day.

Your assistant sees the names and what each key is for, so you can ask "can you reach my Garmin
data?" and get a straight answer. It uses a key inside a command, without the key appearing in the
chat, and **it does not ask you first**: saving a key here is the permission. Save only keys you are
happy for it to use on its own, routines included.

**A key kept in a source.** If the key already lives in 1Password, Bitwarden Secrets Manager or
another [secret source](#secret-sources) you added, pick that source next to the key field (on the
computer) and enter where the key is, such as `op://vault/item/field`. Majordome then keeps no
copy: it reads the key from the source each time your assistant uses it, so a key you change
there is the one used. It checks that it can read the key before saving, and the list says
"Kept in" with the source's name. Removing such a key leaves the source untouched.

Keys you paste are kept in the encrypted file described under [Encrypted file](#encrypted-file) below,
on the computer you saved them on. `majord secret list` shows the same names.

## Secret sources

The place a reference points to is a **secret source**. You add sources in **Settings → Secrets**
(under **Advanced**). Each server keeps its own list.

## Which source to use

| Where Majordome's server runs          | Use                           | A reference looks like        |
| -------------------------------------- | ----------------------------- | ----------------------------- |
| On your Mac                            | **Mac Keychain**              | `keychain://Majordome/openai` |
| On a server of your own (Linux, a VPS) | **Encrypted file**            | `secret://openai`             |
| Anywhere, and you use 1Password        | **1Password**                 | `op://vault/item/field`       |
| Anywhere, and you use Bitwarden        | **Bitwarden Secrets Manager** | `bws://<secret ID>`           |
| Anywhere, and you use a team tool      | **Command**                   | `exec://OPENAI_API_KEY`       |
| In a container that is handed its keys | **Environment variable**      | `env://OPENAI_API_KEY`        |

"The server" is the computer that runs Majordome, which is not always the one in front of you. When
you use Majordome from your phone, the secrets are read on your Mac or your server.

## Add a source and use it

1. Open **Settings → Secrets** and select **Add source**.
2. Choose where the secrets are and give the source a name, for example "My keys".
3. Go to the field that needs the key, for example a provider's API key in
   **Settings → Providers**. A small picker sits next to it. Change it from **Value** to your
   source and enter the reference.
4. Select the check button next to the reference. A tick means the server could read the secret.

Majordome keeps what it read until the server restarts. After you change a secret, select the check
button again, or **Refresh** in **Settings → Providers**, to use the new value.

### Mac Keychain

The Keychain is where your Mac already keeps passwords. Nothing to configure: add the source, then
save each key as a Keychain item.

- In **Keychain Access**, choose **File → New Password Item**. The **Keychain Item Name** and the
  **Account Name** are the two halves of the reference: an item named `Majordome` with the account
  `openai` is `keychain://Majordome/openai`.
- Or in Terminal, which asks for the key without showing it or saving it in your history:

  ```sh
  security add-generic-password -U -s Majordome -a openai -w
  ```

A name can contain spaces. Write any `/` in a name as `%2F` and any `%` as `%25`.

The first time Majordome reads an item you made in Keychain Access, macOS asks on that Mac whether
to allow it. Choose **Always Allow**. Nobody can answer that question from a phone, so do the first
check while you are at the Mac. The Keychain is locked while you are logged out of the Mac, and
nothing can be read then.

This source only works when Majordome's server is a Mac.

### Encrypted file

For a server with no Keychain. Majordome keeps your keys in one encrypted file in its data folder.
You add them from the server's terminal, where the value is typed at a hidden prompt and never
appears in a chat, in your shell history, or in a log:

```sh
majord secret set openai      # asks for the value
majord secret list            # names only, never values
majord secret remove openai
```

With the container image, put `docker compose exec -it majordome` in front of each command. To
save a value from another program, pipe it in: `pass show openai | majord secret set openai`.
Then enter `secret://openai` as the reference.

**What the encryption protects, honestly.** The file is `userdata/secrets/integration-keys.age` in
Majordome's data folder, encrypted with [age](https://age-encryption.org). The key that opens it is
the file next to it, `integration-keys.agekey`. A server that runs unattended has nobody to type a
passphrase, so the key has to be on the same disk. Both files can be read only by the user Majordome
runs as. That means:

- A copy of the encrypted file alone, in a backup or a synced folder, is useless to whoever finds
  it.
- Someone who can read the server's whole disk, or sign in as Majordome's user, has both files and
  can read your keys. The Encrypted file does not protect against a server that is already broken
  into. Nothing stored on that server can.
- Lose the key file and the secrets are gone. Back up both files, in two different places if you
  can, or be ready to save the keys again.

You can open the file without Majordome: `age -d -i integration-keys.agekey integration-keys.age`.

### 1Password

Majordome reads from 1Password with the [1Password CLI](https://developer.1password.com/docs/cli/)
(`op`), which must be installed and signed in on the server. When you add the source, enter the
account: the shorthand, sign-in address (without `https://`), or ID that `op account list` shows.
Copy a reference from 1Password with **Copy Secret Reference**.

A desktop sign-in asks for approval on the server's screen, which you cannot answer from elsewhere.
On a server of your own, sign `op` in with a
[service account](./secrets-1password-service-account.md) or a
[Connect server](./secrets-1password-connect.md) instead.

### Bitwarden Secrets Manager

For secrets kept in [Bitwarden Secrets Manager](https://bitwarden.com/products/secrets-manager/).
This is not the Bitwarden password manager: the password manager has to be unlocked with your
master password, which a server nobody sits at cannot do. Secrets Manager signs in with an access
token, so it works on your always-on server.

1. In Bitwarden, open Secrets Manager, create a **machine account**, give it read access to the
   project that holds your secrets, and create an **access token** for it. Give it only what your
   assistant should reach.
2. In **Settings → Passwords and keys**, under **Keys your assistant can use**, add a key named
   `bitwarden` and paste the access token. (On a server: `majord secret set bitwarden`.)
3. Select **Add source**, choose **Bitwarden Secrets Manager**, and enter `bitwarden` as the
   access token's name. If your account is on Bitwarden's EU cloud, enter
   `https://vault.bitwarden.eu` as the server; for your own Bitwarden server, its address.
4. A reference is `bws://` followed by the secret's ID, which Bitwarden copies with
   **Copy secret ID**: `bws://2863ced6-eba1-48b4-b5c0-afa30104877a`.

Once the source exists, the `bitwarden` key shows "Signs Majordome in to" and the source's name.
Your assistant cannot take that key; it reaches only the secrets you add as keys kept in the
source.

Majordome reads with Bitwarden's `bws` program. The always-on server's image includes it. On a
Mac, install it first with Bitwarden's
[instructions](https://bitwarden.com/help/secrets-manager-cli/). `bws` keeps a sign-in session in
`~/.config/bws/state`, so after you revoke a token in Bitwarden, delete that folder on the server
too.

### Command

For Infisical, Doppler, `pass`, and other tools with a command that prints a secret. When you add
the source you give the program and its fixed arguments, one per line. For each secret, Majordome
runs the program with the name from the reference added as the last argument, and takes what it
prints as the secret.

| Tool      | Program     | Arguments                   | `exec://OPENAI_API_KEY` runs                   |
| --------- | ----------- | --------------------------- | ---------------------------------------------- |
| Infisical | `infisical` | `secrets`, `get`, `--plain` | `infisical secrets get --plain OPENAI_API_KEY` |
| Doppler   | `doppler`   | `secrets`, `get`, `--plain` | `doppler secrets get --plain OPENAI_API_KEY`   |
| pass      | `pass`      | `show`                      | `pass show OPENAI_API_KEY`                     |

- The tool must already be installed and signed in on the server, for the user Majordome runs as.
- The program is run directly, not through a shell: quotes, `$VARIABLES`, pipes and `;` in the
  arguments are passed to it as plain text. If you need those, write a small script and use it as
  the program.
- A name can use letters, digits, `.`, `_`, `-`, and `/` between parts, such as `work/openai`.
- The program has ten seconds to answer. If it fails or takes longer, the secret reads as missing.
  Majordome does not show the program's error text, because it can contain the secret. Run the
  command yourself on the server to see what went wrong.
- The program runs with everything Majordome's user can do, so only people you trust to manage the
  server should be able to change **Settings → Secrets**.

### Environment variable

Reads a variable from the environment the server was started with, which is how containers are
usually handed their keys (`environment:` in `docker-compose.yml`). No setup: add the source and
enter `env://NAME`. A variable that is missing or empty reads as missing. Variables are read when
they are needed, but they only change when the server restarts.

This is the least private source. Programs Majordome starts can inherit the server's environment,
and anyone who can inspect the container or the process can see it.

## What the assistant can and cannot see

- Settings, your notes and the conversation only ever hold the reference. Majordome's server reads
  the secret itself and hands it to the service that needs it.
- The check button reports only whether the secret could be read. The value is never sent to the
  app, and errors never include it.
- One exception to know about: a key you set as an **environment variable of an AI provider** in
  **Settings → Providers** is given to that provider's program, because that is what the setting
  means. Commands that program runs can read it.

## When a secret cannot be read

The provider or feature that needs it shows an error naming the secret source, and the check button
shows a warning. Majordome never replaces a secret it cannot read with another login. Fix the
source, then select the check button, or **Refresh** in **Settings → Providers**:

- **Mac Keychain:** check the item's name and account, and that you allowed the read on the Mac.
- **Encrypted file:** run `majord secret list` on the server. It says what is wrong with the file
  or its key.
- **1Password:** unlock or sign in to 1Password on the server.
- **Command:** run the command yourself on the server, as Majordome's user.
- **Environment variable:** restart the server after setting the variable.

## Remove a source

When you remove a source in **Settings → Secrets**, Majordome lists the fields that read from it.
Removing it clears those fields, so set them again before you need them. The secrets themselves are
not touched.

## When the assistant asks for a secret

When the assistant needs a token or password, it shows a card in the conversation instead of asking
you to paste it into the chat. Type or paste the value and select **Save securely**, or select
**Decline**. If the server has a secret source, the card also lets you pick it and enter a reference
instead. Majordome reads the secret once, when you answer; if it cannot be read, the card says so
and stays open.

The value never appears in the conversation. Most requests keep it from the assistant too: Majordome
passes it to the tool that needs it. When the assistant has to run a command with the value, the
card says so instead: the value goes into a private file that the assistant's commands can read for
about 24 hours.
