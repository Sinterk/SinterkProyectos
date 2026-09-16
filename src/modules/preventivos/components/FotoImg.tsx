import { useEffect, useState } from 'react'

interface Props {
  src: string
  alt: string
  className: string
  onClick?: () => void
}

/**
 * `<img>` con su propio spinner mientras el navegador sigue bajando los
 * bytes de la foto — el spinner de `fotoEstado.ts` ("descargando") solo
 * cubre la espera de la URL (firmada o blob local, casi instantánea); una
 * vez que la URL está lista, el `<img>` normal no daba ningún indicio de
 * que la imagen en sí podía tardar varios segundos en una conexión lenta de
 * terreno (bug real reportado por Andrés: "las fotos están cargando pero no
 * aparece una indicación"). Debe ir dentro de un contenedor `relative` con
 * alto ya fijado por CSS (el `<img>` mantiene su tamaño con `opacity-0`
 * mientras carga, así el contenedor no cambia de alto al terminar).
 */
export function FotoImg({ src, alt, className, onClick }: Props) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { setLoaded(false) }, [src])

  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-800">
          <span className="text-xl animate-spin">⏳</span>
        </div>
      )}
      <img src={src} alt={alt} loading="lazy" onClick={onClick} onLoad={() => setLoaded(true)}
        className={`${className} ${loaded ? '' : 'opacity-0'}`} />
    </>
  )
}
