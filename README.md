# YouthOpps website

Static opportunity discovery for [youthopps.org](https://youthopps.org), hosted on Cloudflare Pages. Original publishers remain authoritative.

Use Node.js 22 or newer:

```sh
git submodule update --init --recursive
npm test
npm run build
python3 -m http.server 8080 --directory dist
```

Every build reads `data-source/datas/<source-id>/{data,metadata}.json`; set `DATA_PATH` to select another compatible snapshot. Missing or malformed required input fails. Tests use temporary fixtures, never published listings. Output is `dist/`; upstream data remains read-only.

Architecture, design, contribution and deployment guidance lives in [five short guides](docs/start-here.md). Configure branding, domain and optional consent-gated analytics in `site.config.json`. See [trust and asset rights](docs/trust.md) for provenance limitations.

The three projects are [data-pipeline](https://github.com/YouthOpps/data-pipeline), [data-source](https://github.com/YouthOpps/data-source) and [website](https://github.com/YouthOpps/youthopps.github.io). The website checks hourly for a changed data revision; unchanged revisions do not trigger an update. A successful build does not confirm production deployment.

Questions: [Discussions](https://github.com/YouthOpps/youthopps.github.io/discussions). Bugs/removal requests: [Issues](https://github.com/YouthOpps/youthopps.github.io/issues). Private matters: **contact@youthopps.org**.

`docs/ai-rules.md` links to the authoritative AI rules and skills in ai-workspace on GitHub. Do not copy their contents into this repository.

## License

Original website software and project documentation are licensed under Apache-2.0. Published opportunity records, publisher text, external links, and branding with unresolved rights are excluded. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Apache-2.0 does not grant rights to publisher data or other third-party materials.
