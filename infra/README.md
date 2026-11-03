# Infraestructura de MileShop

## Desarrollo local

El Compose local provisiona cuatro bases PostgreSQL aisladas por dominio:

```powershell
docker compose -f infra/docker-compose.yml up -d --wait
npm run db:deploy
```

Consulta [`docs/LOCAL_STACK_RUNBOOK.md`](../docs/LOCAL_STACK_RUNBOOK.md) para arrancar los servicios, sembrar el catálogo y ejecutar el smoke de compra.

## Despliegue serverless: Vercel + Neon

La arquitectura elegida para esta etapa despliega la web y los cinco servicios como seis proyectos Vercel independientes, con cuatro bases PostgreSQL de Neon. La guía de proyectos, variables, migraciones y límites está en [`docs/DEPLOYMENT-VERCEL-NEON.md`](../docs/DEPLOYMENT-VERCEL-NEON.md).

El Compose de producción queda como alternativa para una futura VM; no es necesario para desplegar en Vercel. La configuración de esa alternativa está en `docker-compose.production.yml`.

Para el desarrollo local, el Compose de bases de datos:

```bash
cp infra/production.env.example infra/.env.production
docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml config --quiet
```

No uses las credenciales de `infra/docker-compose.yml` en producción y nunca guardes secretos en Git.
