import mark from '../../assets/brand/umbra-symbol.svg';
export function Brand({ symbolOnly = false, className = '' }: { symbolOnly?: boolean; className?: string }) {
  return <span className={`umbra-brand ${className}`}><img className="umbra-symbol" src={mark} alt=""/>{!symbolOnly && <span className="umbra-wordmark">umbra<span className="wordmark-period">.</span></span>}</span>;
}
