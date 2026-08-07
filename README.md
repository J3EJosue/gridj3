# Hojas de Puntos Personalizables

Generador de hojas de cuaderno imprimibles (puntos, líneas, cuadrícula, isométrico, caligrafía, pentagrama) con vista previa en vivo y exportación a PDF vectorial. Pensado para personalizar tamaño de papel, márgenes, patrón, encabezado (nombre/carnet) y logo, y descargar hojas listas para imprimir.

## Qué hace

- **Patrones de página**: puntos, líneas, cuadrícula, isométrico, caligrafía (renglón + guía de altura-x) y pentagrama, con espaciado, grosor, color y opacidad ajustables.
- **Papel**: Carta, A4, Media carta, A5 o Moleskine, con márgenes superior/inferior/lateral independientes.
- **Encabezado y logo**: nombre + carnet en la esquina inferior, y un logo (por defecto el sello institucional) con tamaño, posición y opacidad configurables.
- **Perfiles**: varios perfiles (nombre, carnet, logo propio) guardados en `localStorage`, para reutilizar el generador entre distintas personas sin volver a capturar datos.
- **Exportación PDF**: el botón "Descargar PDF" genera un PDF **vectorial** (puntos como círculos vectoriales, líneas vectoriales, texto real, logo embebido) al tamaño físico exacto del papel elegido, con el número de hojas indicado — no es una captura de pantalla.
- Todos los ajustes se aplican en vivo sobre la vista previa y persisten automáticamente en el navegador.

## Stack

- [Astro](https://astro.build) como framework base (salida estática).
- [React](https://react.dev) para el componente interactivo (`src/components/HojasDePuntos.tsx`), montado como isla con `client:load`.
- [jsPDF](https://github.com/parallax/jsPDF) para la generación de PDF vectorial, cargado de forma diferida (`import()` dinámico) solo cuando se pulsa "Descargar PDF", para no penalizar la carga inicial.
- Sin backend: todo corre en el navegador, con `localStorage` como única persistencia.

## Desarrollo

```sh
npm install
npm run dev       # http://localhost:4321
```

| Comando           | Acción                                       |
| :----------------- | :-------------------------------------------- |
| `npm install`       | Instala dependencias                          |
| `npm run dev`       | Servidor de desarrollo en `localhost:4321`    |
| `npm run build`     | Build de producción a `./dist/`               |
| `npm run preview`   | Sirve el build de producción localmente       |

## Estructura

```text
/
├── public/
│   └── logo-mariano.webp      # logo por defecto (sello institucional)
├── src/
│   ├── components/
│   │   └── HojasDePuntos.tsx  # toda la lógica: estado, patrones, export PDF
│   └── pages/
│       └── index.astro        # layout + estilos globales, monta el componente
└── package.json
```

## Origen

La interfaz y el comportamiento fueron diseñados como prototipo en [Claude Design](https://claude.ai/design) y portados fielmente a este stack (Astro + React + jsPDF).
