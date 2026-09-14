# Release y operaciones

## 1. Objetivo

Este documento define el proceso de entrega y operación de MileShop Platform para asegurar que cada release sea reproducible, verificable y reversible.

## 2. Flujo de release

```bash
git checkout develop
git pull --ff-only origin develop
git checkout -b release/2026.09.13
# ejecutar validaciones finales
npm run typecheck
npm run lint
npm run test
npm run build
# pruebas de smoke y entorno local
# si todo pasa
git checkout main
git merge --no-ff release/2026.09.13
git tag -a v1.0.0 -m "release: v1.0.0"
git push origin main --tags
```

## 3. Requisitos previos al release

Antes de promocionar una versión debe estar comprobado que:

- `develop` está estable;
- CI ejecuta correctamente;
- los tests del sistema pasan;
- el stack local funciona;
- los health checks responden correctamente;
- la documentación de operación está actualizada;
- existe una estrategia de rollback clara.

## 4. Smoke tests mínimos

Se recomienda validar lo siguiente:

- frontend carga y renderiza catálogo;
- API gateway responde y expone health checks;
- catálogo responde con productos válidos;
- orden puede crearse correctamente;
- notification worker procesa eventos y no duplica mensajes;
- entorno local conserva configuración y variables esperadas.

## 5. Rollback

Si una release falla:

1. aislar la causa con evidencia;
2. revertir el merge o revert del cambio específico;
3. validar la corrección;
4. reactivar la release solo cuando la causa se confirme resuelta;
5. documentar la lección y la corrección.

## 6. Observabilidad mínima

Cada servicio debe proporcionar:

- health checks;
- logs estructurados;
- trazabilidad de eventos;
- estado del proceso y errores relevantes;
- capacidad de diagnosticar tiempo de respuesta y fallos.

## 7. Seguridad operativa

- nunca versionar secretos o tokens;
- usar variables de entorno explícitas;
- revisar dependencias y vulnerabilidades;
- mantener configuración por entorno;
- controlar acceso a la infraestructura y a los repositorios.

## 8. Operación y soporte

La operación de la plataforma no debe depender de una memoria individual. Debe poder responderse con documentación, trazabilidad y procedimientos claros.

## 9. Criterio de salida

Una release no debe considerarse cerrada solo por “hacer merge”. Debe considerarse cerrada cuando:

- pasó la validación real;
- quedó documentada;
- tiene rollback definido;
- fue probada por un flujo completo y controlado.

## 10. Conclusión

La operación profesional es la diferencia entre un proyecto que “funciona” y uno que puede sostenerse. Cada release necesita evidencia, trazabilidad y reversión posible.
