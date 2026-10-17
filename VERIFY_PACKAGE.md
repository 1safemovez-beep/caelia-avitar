# Package Verification Checklist

Before production:

- [ ] Confirm source repository ownership
- [ ] Confirm Cloudflare/domain account ownership
- [ ] Confirm backend account ownership
- [ ] Enable MFA
- [ ] Create production secrets vault
- [ ] Remove all placeholder secrets
- [ ] Configure CORS
- [ ] Configure HTTPS
- [ ] Configure authentication
- [ ] Configure authorization
- [ ] Configure audit logs
- [ ] Generate an SBOM
- [ ] Run dependency/security scans
- [ ] Run OWASP ASVS review
- [ ] Test backup and restore
- [ ] Test uninstall/local deletion behavior
- [ ] Review Privacy Policy with counsel
- [ ] Review Terms with counsel
- [ ] Review IP/trademark/copyright notices
- [ ] Obtain production TLS certificate
- [ ] Configure certificate renewal
- [ ] Configure code signing if distributing an app
- [ ] Perform penetration/security testing
