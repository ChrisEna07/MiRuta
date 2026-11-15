import React from 'react';

export type PackageSize = 'small' | 'medium' | 'large';

interface PackageSizeBadgeProps {
  size?: PackageSize | string;
  variant?: 'pill' | 'expanded';
  className?: string;
}

/**
 * Badge de Alto Contraste para Tamaño de Paquete y Guía de Ubicación Física en Moto
 * v8.7: Morral/Tanque (Pequeño), Tanda/Asiento (Mediano) o Parrilla/Red (Voluminoso)
 */
export const PackageSizeBadge: React.FC<PackageSizeBadgeProps> = ({
  size = 'medium',
  variant = 'expanded',
  className = ''
}) => {
  const normalizedSize: PackageSize =
    size === 'small' ? 'small' : size === 'large' ? 'large' : 'medium';

  if (normalizedSize === 'small') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-500/20 text-emerald-300 font-black shadow-sm tracking-tight ${
          variant === 'expanded' ? 'px-2.5 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]'
        } ${className}`}
        title="Ubicación recomendada en moto: Morral o bolsa sobre el tanque"
      >
        <span>🎒</span>
        <span>{variant === 'expanded' ? 'Pequeño (Morral / Tanque)' : 'Morral'}</span>
      </span>
    );
  }

  if (normalizedSize === 'large') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-xl border-2 border-rose-500/60 bg-rose-500/30 text-rose-200 font-black shadow-md animate-pulse tracking-tight ${
          variant === 'expanded' ? 'px-2.5 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]'
        } ${className}`}
        title="Ubicación recomendada en moto: Parrilla trasera asegurada con red elástica"
      >
        <span>⚠️</span>
        <span>{variant === 'expanded' ? 'Bulto Voluminoso (Parrilla / Red)' : 'Parrilla'}</span>
      </span>
    );
  }

  // Mediano por defecto
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/20 text-amber-300 font-black shadow-sm tracking-tight ${
        variant === 'expanded' ? 'px-2.5 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]'
      } ${className}`}
      title="Ubicación recomendada en moto: Lote de tanda sobre el asiento o alforja"
    >
      <span>📦</span>
      <span>{variant === 'expanded' ? 'Mediano (Tanda / Asiento)' : 'Asiento'}</span>
    </span>
  );
};
