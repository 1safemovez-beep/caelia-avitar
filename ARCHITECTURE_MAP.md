# Caelia Architecture Map

                         ┌─────────────────────┐
                         │   Caelia True Form  │
                         │  Avatar / Voice UI  │
                         └──────────┬──────────┘
                                    │ approved intents
                                    v
                         ┌─────────────────────┐
                         │    UI / API Bridge  │
                         └──────────┬──────────┘
                                    │
                                    v
                         ┌─────────────────────┐
                         │ Permission / Policy │
                         │       Boundary      │
                         └──────┬──────┬───────┘
                                │      │
                 ┌──────────────┘      └──────────────┐
                 v                                     v
        ┌─────────────────┐                   ┌─────────────────┐
        │  Caelia Brain   │                   │  Plugin Broker  │
        └───────┬─────────┘                   └───────┬─────────┘
                │                                     │
        ┌───────┴────────┐                    ┌───────┴────────┐
        v                v                    v                v
     Memory          Knowledge            Services        External APIs

                    ┌─────────────────────────────┐
                    │       Secrets Vault         │
                    │ keys • tokens • certificates │
                    └─────────────────────────────┘
