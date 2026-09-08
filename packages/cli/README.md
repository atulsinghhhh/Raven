# @corvidhq/cli

Raven from the terminal — manage projects, API keys, rooms and live
streams, and wire up a local app for RTC development.

Part of [Raven](https://github.com/atulsinghhhh/Raven), open-source real-time communication infrastructure.

## Install

```bash
npm install -g @corvidhq/cli
```

Or run it without installing:

```bash
npx @corvidhq/cli --help
```

## Use

```bash
raven login                    # authenticate
raven whoami                   # who am I, against which deployment
raven projects create my-app   # create a project
raven keys create              # mint an API key for it
raven init                     # scaffold Raven into the app in this directory
raven dev                      # run against a local stack
```

Inspect a running deployment:

```bash
raven rooms list
raven connections list
raven rtc servers list         # the SFU fleet
raven diagnostics
raven errors list
raven logs
raven status
```

`raven <command> --help` documents each group. Also: `chat`, `streams`,
`sdk`, `config`, `version`, `logout`.

## Self-hosting

Point the CLI at your own deployment rather than the default:

```bash
raven config set apiUrl https://api.your-raven-deployment.example
raven config get apiUrl
raven config list
```

`raven config` stores local CLI preferences only — never secrets.

## Documentation

- [CLI reference](https://github.com/atulsinghhhh/Raven/blob/main/docs/cli.md)
- [Walkthrough](https://github.com/atulsinghhhh/Raven/blob/main/examples/cli-workflow.md)

## License

MIT
