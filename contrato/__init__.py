"""Contrato de mensagens MQTT entre as células e o sistema central.

Este pacote é a única fonte de verdade sobre tópicos e formatos de mensagem.
O backend e o simulador importam daqui, e o documento docs/contrato-mqtt.md
descreve o mesmo contrato para o grupo que desenvolve o firmware das placas.
"""

from contrato.mensagens import Estado, Leitura, PedidoSetpoint, RespostaSetpoint
from contrato import topicos

__all__ = ["Estado", "Leitura", "PedidoSetpoint", "RespostaSetpoint", "topicos"]
