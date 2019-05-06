# Kui VSCode Extension

This repository provides a VSCode extension for [Kui](https://github.com/IBM/kui).

## Development Guide

1. [Install VSCode](https://code.visualstudio.com/download)

2. Get the source:

```bash
git clone git@github.com:kui-shell/vscode-extension.git
cd vscode-extension
npm install
```

At the moment, the first npm install will take a bit longer, as the
webpack client is built. We hope to optimize this in the future.

3. Open VSCode to this project directory

4. Enter debg mode: F5 is the usual shortcut for this. You should see
   a second VSCode window pop up.

5. Now execute the Kui command; the keyboard shortcut for this is
   usually Option-X; type or select Kui from the command list.

6. You should see the Kui terminal. Try `ls`.
