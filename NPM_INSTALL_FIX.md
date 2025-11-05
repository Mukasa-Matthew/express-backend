# Fix: npm install fails with pg-native compilation error

## Problem
When running `npm install` on your VPS, you see this error:
```
g++: error: /usr/include/libpq-fe.h: No such file or directory
```

This happens because the PostgreSQL development libraries are missing, which are needed to compile native Node.js modules like `pg-native`.

## Solution

Install the PostgreSQL development package on your Ubuntu/Debian VPS:

```bash
sudo apt update
sudo apt install -y libpq-dev
```

Then try installing dependencies again:

```bash
cd ~/real_devbacke  # or your backend directory
npm install
```

## Additional Build Tools (if still failing)

If you still get compilation errors, you may also need build tools:

```bash
sudo apt install -y build-essential python3
```

## Verify Installation

After installing, verify the headers are available:

```bash
ls -la /usr/include/libpq-fe.h
```

If the file exists, `npm install` should work now.

## Why This Happens

The `pg` package (PostgreSQL client for Node.js) has an optional native dependency (`pg-native`) that provides better performance. This native module needs to be compiled from C++ code, which requires:
- PostgreSQL development headers (`libpq-dev`)
- C++ compiler (`build-essential`)
- Python (for node-gyp)

Most production setups work fine without `pg-native` (it's optional), but if `npm install` tries to build it and fails, it can prevent the entire installation from completing.

